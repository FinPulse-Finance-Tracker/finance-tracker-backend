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

            // Fast path: look up existing user by clerkId (indexed query, no external API call)
            let dbUser = await this.clerkSyncService.getUserByClerkId(payload.sub);

            if (!dbUser) {
                // First-time user only: do full Clerk sync
                const clerkUser = await clerkClient.users.getUser(payload.sub);
                dbUser = await this.clerkSyncService.syncUserFromClerk({
                    id: clerkUser.id,
                    emailAddresses: clerkUser.emailAddresses,
                    firstName: clerkUser.firstName || undefined,
                    lastName: clerkUser.lastName || undefined,
                    imageUrl: clerkUser.imageUrl,
                });
            }

            // Attach user to request (using database user ID)
            request.user = {
                id: dbUser.id,
                clerkId: payload.sub,
                email: dbUser.email,
            };

            return true;
        } catch (error) {
            console.error('❌ Clerk auth error:', error.message);
            throw new UnauthorizedException('Invalid or expired token');
        }
    }
}
