import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
    private readonly logger = new Logger(UserService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
    ) {}

    /**
     * Get or auto-generate the user's email forwarding address.
     * Address format: receipts-{shortId}@{FORWARDING_DOMAIN}
     */
    async getOrCreateForwardingAddress(userId: string): Promise<{ address: string; active: boolean }> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { forwardingAddress: true, forwardingActive: true },
        });

        if (!user) throw new Error(`User ${userId} not found`);

        if (user.forwardingAddress) {
            return { address: user.forwardingAddress, active: user.forwardingActive };
        }

        // Generate a new forwarding address using the first 8 chars of userId
        const shortId = userId.replace(/-/g, '').substring(0, 10).toLowerCase();
        const domain = this.config.get<string>('FORWARDING_DOMAIN') ?? 'receipts.yourapp.com';
        const address = `receipts-${shortId}@${domain}`;

        await this.prisma.user.update({
            where: { id: userId },
            data: { forwardingAddress: address },
        });

        this.logger.log(`📬 Created forwarding address for user ${userId}: ${address}`);
        return { address, active: false };
    }

    /**
     * Mark forwarding as active for this user (called after Gmail filter is created).
     */
    async activateForwarding(userId: string): Promise<void> {
        await this.prisma.user.update({
            where: { id: userId },
            data: { forwardingActive: true },
        });
    }
}
