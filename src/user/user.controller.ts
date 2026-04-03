import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { UserService } from './user.service';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) {}

    /**
     * Returns the user's unique forwarding address.
     * Auto-generates one on first call if not yet created.
     */
    @Get('forwarding-address')
    @UseGuards(ClerkAuthGuard)
    async getForwardingAddress(@Request() req) {
        return this.userService.getOrCreateForwardingAddress(req.user.id);
    }
}
