-- Database dev, test, dan shadow untuk MariaDB lokal.
CREATE DATABASE IF NOT EXISTS studenthub_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS studenthub_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS studenthub_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'studenthub'@'%' IDENTIFIED BY 'studenthub';
GRANT ALL PRIVILEGES ON studenthub_dev.* TO 'studenthub'@'%';
GRANT ALL PRIVILEGES ON studenthub_test.* TO 'studenthub'@'%';
FLUSH PRIVILEGES;
GRANT ALL PRIVILEGES ON studenthub_shadow.* TO 'studenthub'@'%';
FLUSH PRIVILEGES;
