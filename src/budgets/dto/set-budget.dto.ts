import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, IsBoolean, IsArray } from 'class-validator';

export class SetBudgetDto {
    @IsNotEmpty()
    @IsString()
    categoryId: string;

    @IsNotEmpty()
    @IsNumber()
    @Min(0)
    amount: number;

    @IsOptional()
    @IsString()
    period?: string; // e.g., 'monthly'

    @IsOptional()
    @IsBoolean()
    isRecurring?: boolean;

    @IsOptional()
    @IsArray()
    @IsNumber({}, { each: true })
    recurringMonths?: number[];
}
