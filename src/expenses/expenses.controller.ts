import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    Request,
    Query,
} from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('expenses')
@UseGuards(ClerkAuthGuard) // All routes protected
export class ExpensesController {
    constructor(private readonly expensesService: ExpensesService) { }

    @Post()
    create(@Request() req, @Body() createExpenseDto: CreateExpenseDto) {
        return this.expensesService.create(req.user.id, createExpenseDto);
    }

    @Get()
    findAll(
        @Request() req,
        @Query('categoryId') categoryId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.expensesService.findAll(
            req.user.id,
            categoryId,
            startDate,
            endDate,
        );
    }

    @Get('stats')
    getStats(
        @Request() req,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return this.expensesService.getStats(req.user.id, startDate, endDate);
    }

    @Get(':id')
    findOne(@Request() req, @Param('id') id: string) {
        return this.expensesService.findOne(id, req.user.id);
    }

    @Patch(':id')
    update(
        @Request() req,
        @Param('id') id: string,
        @Body() updateExpenseDto: UpdateExpenseDto,
    ) {
        return this.expensesService.update(id, req.user.id, updateExpenseDto);
    }

    @Delete(':id')
    remove(@Request() req, @Param('id') id: string) {
        return this.expensesService.remove(id, req.user.id);
    }
}
