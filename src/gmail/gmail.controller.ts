import {
    Controller,
    Get,
    Post,
    Delete,
    Request,
    Query,
    Body,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { GmailService } from './gmail.service';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('gmail')
export class GmailController {
    constructor(private readonly gmailService: GmailService) { }

    /**
     * Return Gmail OAuth URL — frontend redirects the user to Google
     */
    @Get('connect')
    @UseGuards(ClerkAuthGuard)
    async connect(@Request() req) {
        const state = req.user.id; // use user's DB id as state
        const authUrl = this.gmailService.getAuthUrl(state);
        return { authUrl };
    }

    /**
     * OAuth callback — Google redirects here after user authorization
     */
    @Get('callback')
    async callback(
        @Query('code') code: string,
        @Query('state') userId: string,
        @Res() res: Response,
    ) {
        try {
            await this.gmailService.handleCallback(userId, code);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            res.redirect(`${frontendUrl}/expenses?gmail=connected`);
        } catch (error) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            res.redirect(`${frontendUrl}/expenses?gmail=error`);
        }
    }

    /**
     * Get connection status
     */
    @Get('status')
    @UseGuards(ClerkAuthGuard)
    async getStatus(@Request() req) {
        return this.gmailService.getStatus(req.user.id);
    }

    /**
     * Sync Gmail emails and return extracted expenses
     */
    @Post('sync')
    @UseGuards(ClerkAuthGuard)
    async sync(@Request() req) {
        const expenses = await this.gmailService.syncEmails(req.user.id);
        return { expenses, count: expenses.length };
    }

    /**
     * Import selected expenses
     */
    @Post('import')
    @UseGuards(ClerkAuthGuard)
    async importExpenses(
        @Request() req,
        @Body() body: {
            expenses: Array<{
                merchant: string;
                amount: number;
                date: string;
                description: string;
                emailId: string;
                categoryId?: string;
            }>
        },
    ) {
        const created = await this.gmailService.importExpenses(req.user.id, body.expenses);
        return { imported: created.length, expenses: created };
    }

    /**
     * Disconnect Gmail
     */
    @Delete('disconnect')
    @UseGuards(ClerkAuthGuard)
    async disconnect(@Request() req) {
        await this.gmailService.disconnect(req.user.id);
        return { message: 'Gmail disconnected successfully' };
    }
}
