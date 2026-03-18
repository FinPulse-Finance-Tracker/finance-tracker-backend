import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger('ExceptionFilter');

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const message =
            exception instanceof HttpException
                ? exception.getResponse()
                : (exception as Error).message || 'Internal server error';

        // Detailed logging for Vercel
        this.logger.error(`--- EXCEPTION DETECTED ---`);
        this.logger.error(`Status: ${status}`);
        this.logger.error(`Path: ${request.url}`);
        this.logger.error(`Method: ${request.method}`);
        this.logger.error(`Message: ${JSON.stringify(message)}`);

        if (exception instanceof Error && exception.stack) {
            this.logger.error(`Stack trace: ${exception.stack}`);
        }

        response.status(status).json({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.url,
            message: typeof message === 'object' ? (message as any).message : message,
        });
    }
}
