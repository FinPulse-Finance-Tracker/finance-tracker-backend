import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('feedback')
@UseGuards(ClerkAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  create(@Request() req, @Body() createFeedbackDto: { message: string; rating?: number }) {
    return this.feedbackService.create(req.user.id, createFeedbackDto);
  }
}
