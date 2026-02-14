import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CategoriesModule } from '../categories/categories.module';
import { ClerkSyncService } from './clerk-sync.service';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkAuthGuard } from './guards/clerk-auth.guard';

@Module({
    imports: [
        PassportModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get('JWT_SECRET'),
                signOptions: { expiresIn: '7d' },
            }),
            inject: [ConfigService],
        }),
        forwardRef(() => CategoriesModule),
    ],
    controllers: [AuthController, ClerkWebhookController],
    providers: [AuthService, JwtStrategy, ClerkSyncService, ClerkAuthGuard],
    exports: [AuthService, ClerkSyncService, ClerkAuthGuard],
})
export class AuthModule { }
