import { Controller, Post, Headers, BadRequestException, Req } from '@nestjs/common';
import { Request } from 'express';
import { Webhook } from 'svix';
import { ClerkSyncService } from './clerk-sync.service';
import { Body } from '@nestjs/common';

@Controller('webhooks')
export class ClerkWebhookController {
    constructor(private clerkSyncService: ClerkSyncService) { }

    @Post('clerk')
    async handleClerkWebhook(
        @Headers('svix-id') svixId: string,
        @Headers('svix-timestamp') svixTimestamp: string,
        @Headers('svix-signature') svixSignature: string,
        @Body() body: any,
    ) {
        // Get the raw body for webhook verification
        const rawBody = JSON.stringify(body);

        if (!rawBody) {
            throw new BadRequestException('No body provided');
        }

        // Verify webhook signature
        const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
        if (!webhookSecret) {
            throw new BadRequestException('Webhook secret not configured');
        }

        const wh = new Webhook(webhookSecret);
        let payload: any;

        try {
            payload = wh.verify(rawBody.toString(), {
                'svix-id': svixId,
                'svix-timestamp': svixTimestamp,
                'svix-signature': svixSignature,
            });
        } catch (error) {
            throw new BadRequestException('Invalid webhook signature');
        }

        // Handle different webhook events
        const { type, data } = payload;

        switch (type) {
            case 'user.created':
            case 'user.updated':
                // Sync user to our database
                await this.clerkSyncService.syncUserFromClerk(data);
                break;

            case 'user.deleted':
                // Delete user from our database
                if (data.id) {
                    await this.clerkSyncService.deleteUserByClerkId(data.id);
                }
                break;

            default:
                console.log(`Unhandled webhook event: ${type}`);
        }

        return { success: true };
    }
}
