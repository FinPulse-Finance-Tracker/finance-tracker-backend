import { IsString, IsNotEmpty, IsOptional, IsHexColor, IsNumber, Min } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsHexColor()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  budgetAmount?: number;
}
