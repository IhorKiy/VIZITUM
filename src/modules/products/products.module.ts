import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ProductCategoriesController } from "./product-categories.controller";
import { ProductCategoriesService } from "./product-categories.service";
import { ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";

@Module({
  imports: [AuthModule],
  controllers: [ProductsController, ProductCategoriesController],
  providers: [ProductsService, ProductCategoriesService],
  exports: [ProductsService, ProductCategoriesService],
})
export class ProductsModule {}
