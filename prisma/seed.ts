import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding default categories...');

    const defaultCategories = [
        {
            name: 'Food & Dining',
            icon: '🍔',
            color: '#FF6B6B',
            isDefault: true,
        },
        {
            name: 'Transportation',
            icon: '🚗',
            color: '#4ECDC4',
            isDefault: true,
        },
        {
            name: 'Shopping',
            icon: '🛍️',
            color: '#95E1D3',
            isDefault: true,
        },
        {
            name: 'Entertainment',
            icon: '🎬',
            color: '#FFE66D',
            isDefault: true,
        },
        {
            name: 'Bills & Utilities',
            icon: '💡',
            color: '#FF8B94',
            isDefault: true,
        },
        {
            name: 'Healthcare',
            icon: '🏥',
            color: '#B4D4FF',
            isDefault: true,
        },
        {
            name: 'Education',
            icon: '📚',
            color: '#C7CEEA',
            isDefault: true,
        },
        {
            name: 'Personal Care',
            icon: '💅',
            color: '#FFDAC1',
            isDefault: true,
        },
        {
            name: 'Gifts & Donations',
            icon: '🎁',
            color: '#A8E6CF',
            isDefault: true,
        },
        {
            name: 'Other',
            icon: '📦',
            color: '#D0D0D0',
            isDefault: true,
        },
    ];

    for (const category of defaultCategories) {
        const existing = await prisma.category.findFirst({
            where: {
                name: category.name,
                isDefault: true,
            },
        });

        if (!existing) {
            await prisma.category.create({
                data: {
                    ...category,
                    userId: null, // Default categories don't belong to any user
                },
            });
            console.log(`✅ Created category: ${category.name}`);
        } else {
            console.log(`⏭️  Category already exists: ${category.name}`);
        }
    }

    console.log('✨ Seeding completed!');
}

main()
    .catch((e) => {
        console.error('❌ Error seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
