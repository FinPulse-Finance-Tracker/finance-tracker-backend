import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ExpensesService } from './expenses.service';
import { UserCacheInterceptor } from '../common/interceptors/user-cache.interceptor';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('expenses')
@UseGuards(ClerkAuthGuard) // All routes protected
export class ExpensesController {
    constructor(private readonly expensesService: ExpensesService) { }

    @Post()
    async create(@Request() req, @Body() createExpenseDto: CreateExpenseDto) {
        return this.expensesService.create(req.user.id, createExpenseDto);
    }

    @Get()
    @UseInterceptors(UserCacheInterceptor)
    findAll(
        @Request() req,
        @Query('categoryId') categoryId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.expensesService.findAll(
            req.user.id,
            categoryId,
            startDate,
            endDate,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 200,
        );
    }

    @Get('stats')
    @UseInterceptors(UserCacheInterceptor)
    getStats(
        @Request() req,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.expensesService.getStats(req.user.id, startDate, endDate);
    }

    @Get('export')
    async exportCsv(@Request() req, @Res() res: Response) {
        const csv = await this.expensesService.exportCsv(req.user.id);
        res.header('Content-Type', 'text/csv');
        res.attachment('finpulse_expenses.csv');
        return res.send(csv);
    }

    @Delete('wipe-all')
    async wipeAllData(@Request() req) {
        return this.expensesService.wipeAllData(req.user.id);
    }

    @Get(':id')
    findOne(@Request() req, @Param('id') id: string) {
        return this.expensesService.findOne(id, req.user.id);
    }

    @Patch(':id')
    async update(
        @Request() req,
        @Param('id') id: string,
        @Body() updateExpenseDto: UpdateExpenseDto,
    ) {
        return this.expensesService.update(id, req.user.id, updateExpenseDto);
    }

    @Delete(':id')
    async remove(@Request() req, @Param('id') id: string) {
        return this.expensesService.remove(id, req.user.id);
    }
}
