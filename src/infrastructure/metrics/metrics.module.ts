import { Global, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { HttpMetricsMiddleware } from "./http-metrics.middleware";
import { MetricsServer } from "./metrics-server";
import { MetricsService } from "./metrics.service";

@Global()
@Module({
  providers: [MetricsService, MetricsServer],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes("*");
  }
}
