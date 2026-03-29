import { ExecutionContext, Injectable } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';
@Injectable()
export class UserCacheInterceptor extends CacheInterceptor {
    trackBy(context: ExecutionContext): string | undefined {
        const request = context.switchToHttp().getRequest();
        const userId = request.user?.id || 'anonymous';
        
        // Get the default cache key (usually the request URL)
        const originalKey = super.trackBy(context);
        
        if (!originalKey) {
            return undefined;
        }

        // Prepend the user ID to ensure cache isolation
        return `${userId}:${originalKey}`;
    }
}
