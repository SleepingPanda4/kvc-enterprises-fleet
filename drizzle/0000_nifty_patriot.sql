CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`type` text NOT NULL,
	`notes` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`route_number` text,
	`make_model` text NOT NULL,
	`year` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_number_unique` ON `vehicles` (`number`);
--> statement-breakpoint
CREATE INDEX `idx_issues_vehicle_status` ON `issues` (`vehicle_id`,`status`);
--> statement-breakpoint
INSERT INTO `vehicles` (`number`,`route_number`,`make_model`,`year`) VALUES
('1201','R-14','Ford Transit',2022),
('1208','R-22','Freightliner MT45',2021),
('1214','R-07','Ford Transit',2023),
('1221',NULL,'Freightliner MT45',2020),
('1226','R-18','Ford Transit',2022),
('1230','R-31','Freightliner MT45',2021);
--> statement-breakpoint
INSERT INTO `issues` (`vehicle_id`,`type`,`notes`,`status`) VALUES
(2,'Maintenance','Driver reports a soft brake pedal during the morning pre-trip inspection. Inspect before the next route.','open'),
(2,'Note','Passenger-side mirror housing is loose but visibility is not affected.','open'),
(3,'Other — Body damage','Small scrape on the rear passenger-side panel; photos documented at the terminal.','open'),
(1,'Maintenance','Replaced worn windshield wipers and confirmed washer fluid level.','resolved');
--> statement-breakpoint
PRAGMA optimize;
