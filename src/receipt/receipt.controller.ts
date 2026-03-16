import {
    Controller,
    Post,
    Body,
    Request,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReceiptService } from './receipt.service';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('receipt')
export class ReceiptController {
    constructor(private readonly receiptService: ReceiptService) { }

    /**
     * Extract expense data from an uploaded receipt image or PDF
     */
    @Post('scan')
    @UseGuards(ClerkAuthGuard)
    @UseInterceptors(FileInterceptor('file', {
        limits: {
            fileSize: 10 * 1024 * 1024 // 10MB limit
        }
    }))
    async scanReceipt(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('File is required');
        }

        const expense = await this.receiptService.processFile(file);
        return { expense };
    }

    /**
     * Import a scanned receipt expense to the DB
     */
    @Post('import')
    @UseGuards(ClerkAuthGuard)
    async importExpense(
        @Request() req,
        @Body() body: {
            expense: {
                merchant: string;
                amount: number;
                date: string;
                description: string;
                categoryId?: string;
            }
        }
    ) {
        if (!body.expense) {
            throw new BadRequestException('Expense data is required');
        }
        return this.receiptService.importExpense(req.user.id, body.expense);
    }
}
