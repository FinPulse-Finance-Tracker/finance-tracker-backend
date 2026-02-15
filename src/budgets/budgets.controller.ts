import { Body, Controller, Post, UseGuards, Request } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { SetBudgetDto } from './dto/set-budget.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('budgets')
@UseGuards(ClerkAuthGuard)
export class BudgetsController {
    constructor(private readonly budgetsService: BudgetsService) { }

    @Post()
    setBudget(@Request() req, @Body() setBudgetDto: SetBudgetDto) {
        return this.budgetsService.setBudget(req.user.id, setBudgetDto);
    }
}
