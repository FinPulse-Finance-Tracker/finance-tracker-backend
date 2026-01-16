import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
    constructor(private readonly expensesService: ExpensesService) { }

    @Post()
    create(@Request() req, @Body() createExpenseDto: CreateExpenseDto) {
        return this.expensesService.create(req.user.id, createExpenseDto);
    }

    @Get()
    findAll(@Request() req, @Query() queryDto: QueryExpenseDto) {
        return this.expensesService.findAll(req.user.id, queryDto);
    }

    @Get('statistics')
    getStatistics(
        @Request() req,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.expensesService.getStatistics(req.user.id, startDate, endDate);
    }

    @Get('total')
    getTotalSpending(
        @Request() req,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.expensesService.getTotalSpending(req.user.id, startDate, endDate);
    }

    @Get(':id')
    findOne(@Request() req, @Param('id') id: string) {
        return this.expensesService.findOne(req.user.id, id);
    }

    @Patch(':id')
    update(@Request() req, @Param('id') id: string, @Body() updateExpenseDto: UpdateExpenseDto) {
        return this.expensesService.update(req.user.id, id, updateExpenseDto);
    }

    @Delete(':id')
    remove(@Request() req, @Param('id') id: string) {
        return this.expensesService.remove(req.user.id, id);
    }
}
