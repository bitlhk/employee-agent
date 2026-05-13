-- Create scenarios table
CREATE TABLE `scenarios` (
  `id` varchar(50) PRIMARY KEY NOT NULL,
  `title` varchar(100) NOT NULL,
  `subtitle` varchar(200),
  `description` text,
  `icon` varchar(50),
  `displayOrder` int NOT NULL DEFAULT 0,
  `status` enum('active','hidden') NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
