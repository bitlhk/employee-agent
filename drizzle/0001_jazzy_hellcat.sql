CREATE TABLE `registrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`company` varchar(200) NOT NULL,
	`email` varchar(320) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `registrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visit_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`registrationId` int NOT NULL,
	`scenarioId` varchar(50) NOT NULL,
	`experienceId` varchar(50) NOT NULL,
	`experienceTitle` varchar(200) NOT NULL,
	`clickedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `visit_stats_id` PRIMARY KEY(`id`)
);
