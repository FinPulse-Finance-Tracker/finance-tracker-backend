import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { clerkClient } from '@clerk/clerk-sdk-node';
import { ClerkSyncService } from '../clerk-sync.service';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
    constructor(private clerkSyncService: ClerkSyncService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = request.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            throw new UnauthorizedException('No authorization token provided');
        }

        try {
            // Use networkless verification (modern Clerk approach)
            const payload = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY!,
                issuer: (iss) => iss.startsWith('https://clerk.') || iss.includes('.clerk.accounts'),
            });

            if (!payload || !payload.sub) {
                throw new UnauthorizedException('Invalid token');
            }

            // Get user from Clerk using the userId from token
            const clerkUser = await clerkClient.users.getUser(payload.sub);

            // **AUTO-SYNC: Find or create user in database**
            const dbUser = await this.clerkSyncService.syncUserFromClerk({
                id: clerkUser.id,
                emailAddresses: clerkUser.emailAddresses,
                firstName: clerkUser.firstName || undefined,
                lastName: clerkUser.lastName || undefined,
                imageUrl: clerkUser.imageUrl,
            });

            console.log('✅ User synced:', dbUser.email, 'DB ID:', dbUser.id);

            // Attach user to request (using database user ID)
            request.user = {
                id: dbUser.id,        // Database user ID
                clerkId: payload.sub,
                email: clerkUser.emailAddresses[0]?.emailAddress || '',
            };

            return true;
        } catch (error) {
            console.error('❌ Clerk auth error:', error.message);
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
