import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UseGuards,
    Request,
    Query,
    UseInterceptors
} from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { UserCacheInterceptor } from '../common/interceptors/user-cache.interceptor';
import { SetBudgetDto } from './dto/set-budget.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('budgets')
@UseGuards(ClerkAuthGuard)
export class BudgetsController {
    constructor(private readonly budgetsService: BudgetsService) { }

    @Get()
    @UseInterceptors(UserCacheInterceptor)
    getBudgets(
        @Request() req,
        @Query('month') month?: string,
        @Query('year') year?: string
    ) {
        return this.budgetsService.getBudgets(
            req.user.id,
            month ? parseInt(month, 10) : undefined,
            year ? parseInt(year, 10) : undefined
        );
    }

    @Post()
    setBudget(
        @Request() req, 
        @Body() setBudgetDto: SetBudgetDto,
        @Query('month') month?: string,
        @Query('year') year?: string
    ) {
        return this.budgetsService.setBudget(
            req.user.id, 
            setBudgetDto,
            month ? parseInt(month, 10) : undefined,
            year ? parseInt(year, 10) : undefined
        );
    }

    @Delete(':id')
    deleteBudget(@Request() req, @Param('id') id: string) {
        return this.budgetsService.deleteBudget(req.user.id, id);
    }

    @Get(':categoryId/suggestions')
    getBudgetSuggestions(
        @Request() req,
        @Param('categoryId') categoryId: string,
        @Query('location') location?: string,
        @Query('shoppingType') shoppingType?: string,
    ) {
        return this.budgetsService.getBudgetSuggestions(req.user.id, categoryId, location, shoppingType);
    }
}
