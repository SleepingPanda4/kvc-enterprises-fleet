CREATE TABLE `vehicle_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_models_name_unique` ON `vehicle_models` (`name`);
--> statement-breakpoint
INSERT OR IGNORE INTO `vehicle_models` (`name`) SELECT DISTINCT `make_model` FROM `vehicles` WHERE `make_model` <> '';
--> statement-breakpoint
PRAGMA optimize;
