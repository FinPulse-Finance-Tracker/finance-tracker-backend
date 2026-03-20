import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UseGuards,
    Request,
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { SetBudgetDto } from './dto/set-budget.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('budgets')
@UseGuards(ClerkAuthGuard)
export class BudgetsController {
    constructor(private readonly budgetsService: BudgetsService) { }

    @Get()
    getBudgets(@Request() req) {
        return this.budgetsService.getBudgets(req.user.id);
    }

    @Post()
    setBudget(@Request() req, @Body() setBudgetDto: SetBudgetDto) {
        return this.budgetsService.setBudget(req.user.id, setBudgetDto);
    }

    @Delete(':id')
    deleteBudget(@Request() req, @Param('id') id: string) {
        return this.budgetsService.deleteBudget(req.user.id, id);
    }

    @Get(':categoryId/suggestions')
    getBudgetSuggestions(
        @Request() req,
        @Param('categoryId') categoryId: string,
    ) {
        return this.budgetsService.getBudgetSuggestions(req.user.id, categoryId);
    }
}
