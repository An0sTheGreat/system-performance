using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SystemPerformance;

sealed class WebError(string message) : Exception(message);

// Can I Run It?'s web requests, the app's only outbound traffic besides the opt-in ping. The page sends a
// search term, a Steam app ID or a Hugging Face repo ID, never a URL: each is validated here and the URL
// is built here, only for store.steampowered.com and huggingface.co. Nothing about this PC is sent.
static partial class Web
{
    const string Steam = "https://store.steampowered.com/api/", Hf = "https://huggingface.co/";
    static readonly HttpClient Http = NewClient();
    static readonly ConcurrentDictionary<string, string> Cache = new();   // URL -> reply data, successes only, for this session

    static HttpClient NewClient()
    {
        var http = new HttpClient(new SocketsHttpHandler { UseCookies = false }) { Timeout = TimeSpan.FromSeconds(10) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("SystemPerformance", typeof(Web).Assembly.GetName().Version!.ToString()));
        return http;
    }

    // Returns the reply's data as a JSON string. msg carries term (searches), appId (gameDetails) or repo (model types).
    public static Task<string> Call(string type, JsonElement msg) => type switch
    {
        "gameSearch" => Fetch($"{Steam}storesearch/?term={Term(msg)}&l=english&cc=US", body => new JsonArray([..
            Items(body["items"]).Where(i => i["platforms"]?["windows"]?.GetValueKind() == JsonValueKind.True)
                .Select(i => new JsonObject { ["id"] = C(i["id"]), ["name"] = C(i["name"]), ["image"] = C(i["tiny_image"]) })])),
        "gameDetails" => GameDetails(AppId(msg)),
        "modelSearch" => Fetch($"{Hf}api/models?search={Term(msg)}&sort=downloads&limit=20", body => new JsonArray([..
            Items(body).Select(m => new JsonObject { ["id"] = C(m["id"]), ["downloads"] = C(m["downloads"]), ["likes"] = C(m["likes"]), ["task"] = C(m["pipeline_tag"]) })])),
        "modelInfo" => Fetch($"{Hf}api/models/{Repo(msg)}", m =>
        {
            var baseModel = m["cardData"]?["base_model"];
            return new JsonObject
            {
                ["id"] = C(m["id"]), ["task"] = C(m["pipeline_tag"]), ["downloads"] = C(m["downloads"]), ["likes"] = C(m["likes"]),
                ["params"] = C(m["safetensors"]?["total"] ?? m["gguf"]?["total"]), ["ctx"] = C(m["gguf"]?["context_length"]),
                ["baseModel"] = C(baseModel is JsonArray list ? list.FirstOrDefault() : baseModel), ["gated"] = C(m["gated"]),
            };
        }),
        "modelFiles" => Fetch($"{Hf}api/models/{Repo(msg)}/tree/main?recursive=true", body => new JsonArray([..   // ponytail: first page only (HF pages at 1000 entries); follow the Link header if repos that big matter
            Items(body).Where(f => (string?)f["type"] == "file")
                .Select(f => new JsonObject { ["path"] = C(f["path"]), ["size"] = C(f["lfs"]?["size"] ?? f["size"]) })])),
        "modelConfig" => Fetch($"{Hf}{Repo(msg)}/resolve/main/config.json", body => body, nullOn404: true),
        // base_model:quantized lists every quantization (AWQ, FP8, MLX, ...); filter=gguf keeps the GGUF repos.
        "modelGguf" => Fetch($"{Hf}api/models?filter=base_model:quantized:{Repo(msg)}&filter=gguf&sort=downloads&limit=20", body => new JsonArray([..
            Items(body).Select(m => new JsonObject { ["id"] = C(m["id"]), ["downloads"] = C(m["downloads"]) })])),
        _ => throw new WebError("unknown request"),
    };

    static Task<string> GameDetails(string app) => Fetch($"{Steam}appdetails?appids={app}&l=english", body =>
    {
        var entry = body[app];
        if (entry?["success"]?.GetValueKind() != JsonValueKind.True) throw new WebError("http 404");   // Steam's "no such app"
        var d = entry["data"]!;
        var req = d["pc_requirements"] as JsonObject;   // [] when the store lists none
        return new JsonObject
        {
            ["name"] = C(d["name"]), ["type"] = C(d["type"]), ["image"] = C(d["header_image"]), ["released"] = C(d["release_date"]?["date"]),
            ["min"] = Text(req?["minimum"]), ["rec"] = Text(req?["recommended"]),
        };
    });

    static async Task<string> Fetch(string url, Func<JsonNode, JsonNode?> shape, bool nullOn404 = false)
    {
        if (Cache.TryGetValue(url, out var cached)) return cached;
        string body;
        try
        {
            using var r = await Http.GetAsync(url).ConfigureAwait(false);
            if (nullOn404 && r.StatusCode == HttpStatusCode.NotFound) return "null";
            if (!r.IsSuccessStatusCode) throw new WebError("http " + (int)r.StatusCode);
            body = await r.Content.ReadAsStringAsync().ConfigureAwait(false);
        }
        catch (TaskCanceledException) { throw new WebError("timeout"); }
        catch (HttpRequestException ex) when (ex.StatusCode is null) { throw new WebError("offline"); }
        return Cache[url] = shape(JsonNode.Parse(body)!)?.ToJsonString() ?? "null";
    }

    static IEnumerable<JsonNode> Items(JsonNode? list) => (list as JsonArray ?? []).OfType<JsonNode>();
    static JsonNode? C(JsonNode? n) => n?.DeepClone();
    static JsonNode? Text(JsonNode? n) => n?.GetValueKind() == JsonValueKind.String ? n.DeepClone() : null;

    // ---- validation: anything else is "bad request" ----
    static string? Arg(JsonElement msg, string name) =>
        !msg.TryGetProperty(name, out var v) ? null : v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : null;

    static string Term(JsonElement msg) =>
        Arg(msg, "term")?.Trim() is { Length: >= 1 and <= 100 } t ? Uri.EscapeDataString(t) : throw new WebError("bad request");

    static string AppId(JsonElement msg) =>
        Arg(msg, "appId") is { } a && AppIdPattern().IsMatch(a) ? a : throw new WebError("bad request");

    static string Repo(JsonElement msg) =>
        Arg(msg, "repo") is { Length: <= 96 } r && RepoPattern().IsMatch(r) && !r.Contains("..") ? r : throw new WebError("bad request");

    // \z, not $: $ also matches before a trailing newline. [0-9], not \d: \d matches any Unicode digit.
    [GeneratedRegex(@"^[0-9]{1,10}\z")] private static partial Regex AppIdPattern();
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+\z")] private static partial Regex RepoPattern();
}
