import { IsString, IsNotEmpty, IsNumber, IsDateString, IsOptional, Min, IsBoolean, IsIn } from 'class-validator';

export class CreateExpenseDto {
    @IsNumber()
    @Min(0)
    amount: number;

    @IsString()
    @IsNotEmpty()
    description: string;

    @IsString()
    @IsNotEmpty()
    categoryId: string;

    @IsDateString()
    date: string;

    @IsString()
    @IsOptional()
    notes?: string;

    @IsString()
    @IsOptional()
    receiptUrl?: string;

    @IsBoolean()
    @IsOptional()
    isRecurring?: boolean;

    @IsString()
    @IsOptional()
    @IsIn(['daily', 'weekly', 'monthly', 'yearly'])
    recurringInterval?: string;

    @IsDateString()
    @IsOptional()
    nextRecurringDate?: string;

    @IsString()
    @IsOptional()
    @IsIn(['active', 'inactive'])
    recurringStatus?: string;
}
