import { IsOptional, IsString, IsNumber, Min, Max, IsEnum, IsDateString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryExpenseDto {
    // Filtering
    @IsUUID()
    @IsOptional()
    categoryId?: string;

    @IsDateString()
    @IsOptional()
    startDate?: string;

    @IsDateString()
    @IsOptional()
    endDate?: string;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    minAmount?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    maxAmount?: number;

    @IsString()
    @IsOptional()
    merchant?: string;

    // Pagination
    @IsNumber()
    @IsOptional()
    @Min(1)
    @Type(() => Number)
    page?: number = 1;

    @IsNumber()
    @IsOptional()
    @Min(1)
    @Max(100)
    @Type(() => Number)
    limit?: number = 20;

    // Sorting
    @IsString()
    @IsOptional()
    @IsEnum(['date', 'amount', 'createdAt'])
    sortBy?: string = 'date';

    @IsString()
    @IsOptional()
    @IsEnum(['asc', 'desc'])
    sortOrder?: 'asc' | 'desc' = 'desc';
}
