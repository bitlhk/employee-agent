CREATE TABLE `scenario_experiences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scenarioId` varchar(50) NOT NULL,
	`experienceId` varchar(50) NOT NULL,
	`title` varchar(200) NOT NULL,
	`industry` varchar(50) NOT NULL,
	`description` text NOT NULL,
	`features` text NOT NULL,
	`image` varchar(500) NOT NULL,
	`url` varchar(500),
	`status` enum('available','developing') NOT NULL DEFAULT 'available',
	`displayOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scenario_experiences_id` PRIMARY KEY(`id`),
	CONSTRAINT `scenario_experiences_experienceId_unique` UNIQUE(`experienceId`)
);
--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` varchar(50) NOT NULL,
	`title` varchar(100) NOT NULL,
	`subtitle` varchar(200),
	`description` text NOT NULL,
	`displayOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scenarios_id` PRIMARY KEY(`id`)
);
