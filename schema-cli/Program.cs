using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Content.Editor.Editor;

namespace Content.Editor;

/// <summary>
/// One-shot CLI that reads the compiled DLLs of a built SS14 fork and writes a
/// single <c>metadata.json</c> describing every prototype, component and
/// <c>[DataDefinition]</c> with their fields, defaults, enum values, XML docs
/// and inheritance flags.
///
/// All of the extraction is the vendored <see cref="MetadataExtractor"/> from
/// the predecessor editor (TheShuEd/SS14Editor@7dcf674). This entry point only
///   * resolves the fork's input DLLs,
///   * adds the two contract roots <c>schemaVersion</c> and
///     <c>sourceFingerprint</c> in front of the predecessor's
///     <c>MetadataRoot</c> shape, and
///   * skips the whole scan as a fast no-op when a sidecar fingerprint file
///     next to the output already matches the current input.
/// </summary>
public static class Program
{
    /// <summary>Bumped whenever the emitted document's shape changes.</summary>
    public const int SchemaVersion = 1;

    public static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine(
                "usage: dotnet SS14Editor.SchemaCli.dll <forkRoot> <outputDir>\n" +
                "  <forkRoot>   built fork root holding bin/Content.Server and/or bin/Content.Client\n" +
                "  <outputDir>  directory to write metadata.json + metadata.fingerprint into");
            return 2;
        }

        var forkRoot = Path.GetFullPath(args[0]);
        var outputDir = Path.GetFullPath(args[1]);

        var inputDlls = new[] { "Content.Server", "Content.Client" }
            .Select(name => Path.Combine(forkRoot, "bin", name))
            .Where(Directory.Exists)
            .SelectMany(dir => Directory.GetFiles(dir, "*.dll", SearchOption.TopDirectoryOnly))
            .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (inputDlls.Length == 0)
        {
            Console.Error.WriteLine(
                $"error: no DLLs found under '{Path.Combine(forkRoot, "bin", "Content.Server")}' " +
                $"or '{Path.Combine(forkRoot, "bin", "Content.Client")}' — build the fork first (dotnet build).");
            return 1;
        }

        var fingerprint = ComputeSourceFingerprint(inputDlls);
        Directory.CreateDirectory(outputDir);
        var outputPath = Path.Combine(outputDir, "metadata.json");
        var fingerprintPath = Path.Combine(outputDir, "metadata.fingerprint");

        if (File.Exists(outputPath) && File.Exists(fingerprintPath) &&
            File.ReadAllText(fingerprintPath).Trim() == fingerprint)
        {
            Console.WriteLine($"metadata.json is up to date (fingerprint {fingerprint[..12]}…) — nothing to do.");
            return 0;
        }

        JsonObject metadata;
        var scratch = Directory.CreateTempSubdirectory("ss14-schema-cli-");
        try
        {
            // The vendored extractor derives bin/Content.{Server,Client} from
            // the root it is given and writes its own metadata.json there.
            MetadataExtractor.Extract(forkRoot, scratch.FullName);
            var producedPath = Path.Combine(scratch.FullName, "metadata.json");
            if (!File.Exists(producedPath))
            {
                Console.Error.WriteLine(
                    "error: extraction produced no metadata — the fork's DLLs could not be read.");
                return 1;
            }

            metadata = JsonNode.Parse(File.ReadAllText(producedPath))!.AsObject();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"error: schema extraction failed: {ex.Message}");
            return 1;
        }
        finally
        {
            try { scratch.Delete(recursive: true); } catch { /* best effort */ }
        }

        // Contract = the two new roots, then MetadataRoot's own members verbatim.
        var document = new JsonObject
        {
            ["schemaVersion"] = SchemaVersion,
            ["sourceFingerprint"] = fingerprint,
        };
        foreach (var property in metadata.ToArray())
        {
            metadata.Remove(property.Key);
            document[property.Key] = property.Value;
        }

        File.WriteAllText(
            outputPath,
            document.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        File.WriteAllText(fingerprintPath, fingerprint);

        Console.WriteLine(
            $"wrote {outputPath} from {inputDlls.Length} DLLs (fingerprint {fingerprint[..12]}…).");
        return 0;
    }

    /// <summary>
    /// SHA256 over <c>path|size|mtime</c> of every input DLL plus this CLI's
    /// own version. Uses file metadata rather than content hashes: MSBuild
    /// rewrites an output DLL on every rebuild, so size or last-write-time is
    /// enough to detect a change and is orders of magnitude cheaper for a
    /// fork with ~1000 DLLs.
    /// </summary>
    private static string ComputeSourceFingerprint(string[] dllPaths)
    {
        var sb = new StringBuilder();
        foreach (var path in dllPaths)
        {
            var info = new FileInfo(path);
            sb.Append(info.FullName).Append('|')
              .Append(info.Length).Append('|')
              .Append(info.LastWriteTimeUtc.Ticks).Append('\n');
        }

        var version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
        sb.Append("cliVersion|").Append(version);

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
