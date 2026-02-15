import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';

@Controller('categories')
@UseGuards(ClerkAuthGuard)  // All routes protected
export class CategoriesController {
    constructor(private readonly categoriesService: CategoriesService) { }

    @Get()
    findAll(@Request() req) {
        return this.categoriesService.findAll(req.user.id);
    }

    @Post()
    create(@Request() req, @Body() createCategoryDto: CreateCategoryDto) {
        return this.categoriesService.create(req.user.id, createCategoryDto);
    }

    @Get(':id')
    findOne(@Request() req, @Param('id') id: string) {
        return this.categoriesService.findOne(id, req.user.id);
    }

    @Patch(':id')
    update(
        @Request() req,
        @Param('id') id: string,
        @Body() updateCategoryDto: UpdateCategoryDto,
    ) {
        return this.categoriesService.update(id, req.user.id, updateCategoryDto);
    }

    @Delete(':id')
    remove(@Request() req, @Param('id') id: string) {
        return this.categoriesService.remove(id, req.user.id);
    }
}
