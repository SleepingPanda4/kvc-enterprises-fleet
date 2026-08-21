UPDATE `vehicles` SET `route_number` = NULL WHERE `id` NOT IN (SELECT MIN(`id`) FROM `vehicles` WHERE `route_number` IS NOT NULL GROUP BY `route_number`) AND `route_number` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_route_number_unique` ON `vehicles` (`route_number`) WHERE "vehicles"."route_number" IS NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
