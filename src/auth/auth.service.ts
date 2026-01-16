import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CategoriesService } from '../categories/categories.service';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private categoriesService: CategoriesService,
    ) { }

    // Register new user
    async register(registerDto: RegisterDto) {
        const { email, password, name, monthlyIncome } = registerDto;

        // Check if user already exists
        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await this.prisma.user.create({
            data: {
                email,
                passwordHash: hashedPassword,
                name,
                monthlyIncome: monthlyIncome ? monthlyIncome.toString() : null,
            },
        });

        // Seed default categories for the new user
        await this.categoriesService.seedDefaultCategories(user.id);

        // Generate JWT token
        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
            },
            token,
        };
    }

    // Login user
    async login(loginDto: LoginDto) {
        const { email, password } = loginDto;

        // Find user
        const user = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Check if user is OAuth user (no password)
        if (!user.passwordHash) {
            throw new UnauthorizedException('This account uses social login. Please sign in with your OAuth provider.');
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Generate JWT token
        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
            },
            token,
        };
    }

    // Get current user profile
    async getProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                currency: true,
                monthlyIncome: true,
                createdAt: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return user;
    }

    // Helper: Generate JWT token
    private generateToken(userId: string, email: string): string {
        const payload = { sub: userId, email };
        return this.jwtService.sign(payload);
    }

    // Validate user for JWT strategy
    async validateUser(userId: string) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
            },
        });
    }
}
