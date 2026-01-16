import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
    constructor(private readonly categoriesService: CategoriesService) { }

    @Post()
    create(@Request() req, @Body() createCategoryDto: CreateCategoryDto) {
        return this.categoriesService.create(req.user.id, createCategoryDto);
    }

    @Get()
    findAll(@Request() req) {
        return this.categoriesService.findAll(req.user.id);
    }

    @Get(':id')
    findOne(@Request() req, @Param('id') id: string) {
        return this.categoriesService.findOne(req.user.id, id);
    }

    @Patch(':id')
    update(@Request() req, @Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
        return this.categoriesService.update(req.user.id, id, updateCategoryDto);
    }

    @Delete(':id')
    remove(@Request() req, @Param('id') id: string) {
        return this.categoriesService.remove(req.user.id, id);
    }
}
