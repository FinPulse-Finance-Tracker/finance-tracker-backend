import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { ClerkSyncService } from '../clerk-sync.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    private clerkClient;

    constructor(
        private authService: AuthService,
        private configService: ConfigService,
        private clerkSyncService: ClerkSyncService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKeyProvider: passportJwtSecret({
                cache: true,
                rateLimit: true,
                jwksRequestsPerMinute: 5,
                jwksUri: configService.get<string>('CLERK_JWKS_URI')!,
            }),
            issuer: configService.get('CLERK_ISSUER'),
            algorithms: ['RS256'],
        });

        this.clerkClient = createClerkClient({
            secretKey: configService.get('CLERK_SECRET_KEY'),
        });
    }

    async validate(payload: any) {
        console.log('--- AUTH VALIDATION START ---');
        console.log('Clerk Sub (Payload):', payload.sub);
        console.log('Issuer:', payload.iss);

        let user = await this.authService.validateUser(payload.sub);

        if (!user) {
            console.log('User not found in local DB. sub:', payload.sub);
            console.log('Attempting auto-sync with Clerk...');
            // Auto-sync: If user doesn't exist in our DB, fetch from Clerk and sync
            try {
                const clerkUser = await this.clerkClient.users.getUser(payload.sub);
                console.log('Clerk User fetched:', clerkUser.id, clerkUser.emailAddresses[0]?.emailAddress);
                user = await this.clerkSyncService.syncUserFromClerk(clerkUser as any);
                console.log('Auto-sync successful. New User ID:', user.id);
            } catch (error) {
                console.error('Failed to auto-sync Clerk user:', error);
                throw new UnauthorizedException('User registration failed or user not found in Clerk.');
            }
        } else {
            console.log('User validated successfully from local DB:', user.id);
        }

        console.log('--- AUTH VALIDATION END ---');
        return user;
    }
}
