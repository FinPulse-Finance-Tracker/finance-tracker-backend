import { IsNotEmpty, IsNumber, IsString, IsOptional, Min } from 'class-validator';

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
}
