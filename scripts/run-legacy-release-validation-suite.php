#!/usr/bin/env php
<?php

declare(strict_types=1);

if ($argc < 2) {
    fwrite(STDERR, "Usage: php scripts/run-legacy-release-validation-suite.php <output-path> [legacy-tests-dir]\n");
    exit(1);
}

$outputPath = $argv[1];
$workspaceRoot = dirname(__DIR__);
$defaultLegacyTestsDir = dirname($workspaceRoot) . DIRECTORY_SEPARATOR . 'legacy' . DIRECTORY_SEPARATOR . 'tests';
$legacyTestsDir = $argv[2] ?? $defaultLegacyTestsDir;

$files = glob($legacyTestsDir . DIRECTORY_SEPARATOR . 'test_*.php');
if ($files === false) {
    fwrite(STDERR, "Unable to enumerate legacy PHP tests in {$legacyTestsDir}.\n");
    exit(1);
}

sort($files, SORT_NATURAL | SORT_FLAG_CASE);

$results = [];
foreach ($files as $filePath) {
    $startedAt = microtime(true);
    $descriptorSpec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($filePath);
    $pipes = [];
    $process = proc_open($command, $descriptorSpec, $pipes, $workspaceRoot);

    if (!is_resource($process)) {
        $results[] = [
            'file' => basename($filePath),
            'passed' => false,
            'exitCode' => null,
            'durationMs' => (int) round((microtime(true) - $startedAt) * 1000),
            'stdout' => '',
            'stderr' => 'Unable to start legacy PHP test process.',
        ];
        continue;
    }

    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    $results[] = [
        'file' => basename($filePath),
        'passed' => $exitCode === 0,
        'exitCode' => $exitCode,
        'durationMs' => (int) round((microtime(true) - $startedAt) * 1000),
        'stdout' => is_string($stdout) ? $stdout : '',
        'stderr' => is_string($stderr) ? $stderr : '',
    ];
}

$outputDir = dirname($outputPath);
if (!is_dir($outputDir) && !mkdir($outputDir, 0777, true) && !is_dir($outputDir)) {
    fwrite(STDERR, "Unable to create output directory {$outputDir}.\n");
    exit(1);
}

$encoded = json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
if (!is_string($encoded) || file_put_contents($outputPath, $encoded . PHP_EOL) === false) {
    fwrite(STDERR, "Unable to write legacy PHP results to {$outputPath}.\n");
    exit(1);
}
