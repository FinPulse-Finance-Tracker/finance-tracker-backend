import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FeedbackService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, data: { message: string; rating?: number }) {
    return this.prisma.feedback.create({
      data: {
        userId,
        message: data.message,
        rating: data.rating,
      },
    });
  }
}
