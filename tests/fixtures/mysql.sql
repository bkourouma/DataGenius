CREATE DATABASE dg_source_mysql;
CREATE TABLE dg_source_mysql.ventes (
  id bigint PRIMARY KEY,
  montant decimal(20, 2) NOT NULL,
  jour date NOT NULL
);
INSERT INTO dg_source_mysql.ventes VALUES
  (9007199254740993, 10.01, '2026-10-01'),
  (9007199254740994, 21.22, '2026-10-02');
