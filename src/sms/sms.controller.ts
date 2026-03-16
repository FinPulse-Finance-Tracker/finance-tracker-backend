import {
    Controller,
    Post,
    Body,
    Request,
    UseGuards,
} from '@nestjs/common';
import { SmsService } from './sms.service';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('sms')
export class SmsController {
    constructor(private readonly smsService: SmsService) { }

    /**
     * Parse raw SMS text and return extracted expenses
     */
    @Post('parse')
    @UseGuards(ClerkAuthGuard)
    parse(@Body() body: { text: string }) {
        if (!body.text || typeof body.text !== 'string') {
            return { expenses: [], count: 0 };
        }
        const expenses = this.smsService.parseSms(body.text);
        return { expenses, count: expenses.length };
    }

    /**
     * Import selected SMS expenses into the database
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
                categoryId?: string;
            }>
        },
    ) {
        if (!body.expenses || !Array.isArray(body.expenses)) {
            return { imported: 0, expenses: [] };
        }
        return this.smsService.importExpenses(req.user.id, body.expenses);
    }
}
