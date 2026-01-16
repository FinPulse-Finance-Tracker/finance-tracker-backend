export class CategoryDto {
    id: string;
    userId: string;
    name: string;
    icon?: string;
    color?: string;
    budgetAmount?: number;
    isDefault: boolean;
    createdAt: Date;
}
