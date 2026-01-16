import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';

interface ClerkUser {
    id: string; // Clerk ID
    emailAddresses: Array<{ emailAddress: string }>;
    firstName?: string;
    lastName?: string;
    imageUrl?: string;
}

@Injectable()
export class ClerkSyncService {
    constructor(
        private prisma: PrismaService,
        private categoriesService: CategoriesService,
    ) { }

    /**
     * Find or create user from Clerk data
     */
    async syncUserFromClerk(clerkUser: ClerkUser) {
        const email = clerkUser.emailAddresses[0]?.emailAddress;
        const name = clerkUser.firstName && clerkUser.lastName
            ? `${clerkUser.firstName} ${clerkUser.lastName}`
            : clerkUser.firstName || null;

        // Check if user already exists with this clerkId
        let user = await this.prisma.user.findUnique({
            where: { clerkId: clerkUser.id },
        });

        if (user) {
            // Update existing user (in case profile changed)
            user = await this.prisma.user.update({
                where: { clerkId: clerkUser.id },
                data: {
                    email,
                    name,
                    profilePicture: clerkUser.imageUrl,
                },
            });
        } else {
            // Create new user
            user = await this.prisma.user.create({
                data: {
                    clerkId: clerkUser.id,
                    email,
                    name,
                    profilePicture: clerkUser.imageUrl,
                    passwordHash: null, // OAuth users don't have passwords
                },
            });

            // Seed default categories for new user
            await this.categoriesService.seedDefaultCategories(user.id);
        }

        return user;
    }

    /**
     * Delete user by Clerk ID
     */
    async deleteUserByClerkId(clerkId: string) {
        await this.prisma.user.delete({
            where: { clerkId },
        });
    }

    /**
     * Get user by Clerk ID
     */
    async getUserByClerkId(clerkId: string) {
        return this.prisma.user.findUnique({
            where: { clerkId },
        });
    }
}
