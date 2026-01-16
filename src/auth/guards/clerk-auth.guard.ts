import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { clerkClient } from '@clerk/clerk-sdk-node';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const sessionToken = request.headers.authorization?.replace('Bearer ', '');

        if (!sessionToken) {
            throw new UnauthorizedException('No authorization token provided');
        }

        try {
            // Verify session with Clerk
            const session = await clerkClient.sessions.verifySession(sessionToken, sessionToken);

            if (!session || !session.userId) {
                throw new UnauthorizedException('Invalid session');
            }

            // Get user from Clerk
            const clerkUser = await clerkClient.users.getUser(session.userId);

            // Attach user to request (matching your existing structure)
            request.user = {
                id: session.userId, // clerkId
                clerkId: session.userId,
                email: clerkUser.emailAddresses[0]?.emailAddress || '',
            };

            return true;
        } catch (error) {
            throw new UnauthorizedException('Invalid or expired session');
        }
    }
}
