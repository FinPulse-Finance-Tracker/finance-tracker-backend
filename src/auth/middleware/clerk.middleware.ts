import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { clerkClient } from '@clerk/clerk-sdk-node';

// Extend Express Request to include clerk user info
export interface ClerkRequest extends Request {
    clerkUser?: {
        id: string;
        clerkId: string;
        email: string;
    };
}

@Injectable()
export class ClerkMiddleware implements NestMiddleware {
    async use(req: ClerkRequest, res: Response, next: NextFunction) {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '');

        if (!sessionToken) {
            return next();
        }

        try {
            // Verify the session token with Clerk
            const session = await clerkClient.sessions.verifySession(sessionToken, sessionToken);

            if (!session) {
                throw new UnauthorizedException('Invalid session');
            }

            // Get user from Clerk
            const clerkUser = await clerkClient.users.getUser(session.userId);

            // Attach user info to request
            req.user = {
                id: session.userId, // This will be the clerkId
                clerkId: session.userId,
                email: clerkUser.emailAddresses[0]?.emailAddress || '',
            };

            next();
        } catch (error) {
            next();
        }
    }
}
