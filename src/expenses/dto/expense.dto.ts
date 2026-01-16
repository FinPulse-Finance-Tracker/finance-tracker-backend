import { CategoryDto } from '../../categories/dto/category.dto';

export class ExpenseDto {
    id: string;
    userId: string;
    categoryId?: string;
    amount: number;
    description?: string;
    merchant?: string;
    date: Date;
    paymentMethod?: string;
    receiptUrl?: string;
    isRecurring: boolean;
    source?: string;
    emailId?: string;
    createdAt: Date;
    updatedAt: Date;
    category?: CategoryDto;
}

export class PaginatedExpensesDto {
    data: ExpenseDto[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export class ExpenseStatisticsDto {
    totalSpending: number;
    byCategory: Array<{
        categoryId: string;
        categoryName: string;
        categoryIcon?: string;
        categoryColor?: string;
        total: number;
        count: number;
        percentage: number;
    }>;
    period: {
        startDate: string;
        endDate: string;
    };
}
