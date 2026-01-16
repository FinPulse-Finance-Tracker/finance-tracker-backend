import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsDateString, IsBoolean, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExpenseDto {
    @IsNumber()
    @Min(0)
    amount: number;

    @IsDateString()
    @IsNotEmpty()
    date: string;

    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    merchant?: string;

    @IsString()
    @IsOptional()
    paymentMethod?: string;

    @IsBoolean()
    @IsOptional()
    isRecurring?: boolean;
}
