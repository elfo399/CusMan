-- Tabella partner/clienti in collaborazione (versione con coordinate)
CREATE TABLE IF NOT EXISTS `clienti_partner` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `referent` varchar(150) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `phone` varchar(30) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `site` varchar(255) DEFAULT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `domain_expiry` date DEFAULT NULL,
  `hosting_provider` varchar(100) DEFAULT NULL,
  `hosting_expiry` date DEFAULT NULL,
  `ssl_expiry` date DEFAULT NULL,
  `panel_url` varchar(255) DEFAULT NULL,
  `status` varchar(100) DEFAULT NULL,
  `assign` varchar(100) DEFAULT NULL,
  `data_start` date DEFAULT NULL,
  `data_end` date DEFAULT NULL,
  `renew_date` date DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `note` text,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_assign` (`assign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Compatibilità: aggiungi colonne se mancanti
ALTER TABLE `clienti_partner` ADD COLUMN IF NOT EXISTS `latitude` decimal(10,7) NULL AFTER `domain`;
ALTER TABLE `clienti_partner` ADD COLUMN IF NOT EXISTS `longitude` decimal(10,7) NULL AFTER `latitude`;

-- Record di test (se la tabella è vuota)
INSERT INTO `clienti_partner`
  (`name`,`referent`,`email`,`phone`,`address`,`site`,`domain`,`latitude`,`longitude`,`domain_expiry`,`hosting_provider`,`hosting_expiry`,`ssl_expiry`,`panel_url`,`status`,`assign`,`data_start`,`renew_date`,`price`,`note`)
SELECT 'Acme S.r.l.', 'Mario Rossi', 'mario.rossi@acme.example', '+39 320 123 4567', 'Via Roma 1, Bari',
       'https://www.acme.example', 'acme.example', NULL, NULL, DATE_ADD(CURDATE(), INTERVAL 180 DAY), 'NetHost', DATE_ADD(CURDATE(), INTERVAL 150 DAY), DATE_ADD(CURDATE(), INTERVAL 120 DAY),
       'https://panel.nethost.example', 'attivo', 'alfonso', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 150 DAY), 950.00,
       'Cliente demo per test UI'
WHERE NOT EXISTS (SELECT 1 FROM `clienti_partner` LIMIT 1);
