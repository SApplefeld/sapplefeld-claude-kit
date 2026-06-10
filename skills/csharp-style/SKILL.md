---
name: csharp-style
description: Scott Applefeld's C# house style. Use whenever writing or modifying ANY C# code — new services, handlers, helpers, MediatR notifications, models, DI registration, or refactoring existing C#. Signature traits — #region organization, section comments ending in periods, static Serilog logger, grouped fields with label comments. Trigger on any C# work even when style isn't named.
---

# C# Style

Scott's personal C# style. Internalize the philosophy, then consult [references/csharp-style.md](references/csharp-style.md) for the detailed pattern reference (full file/class anatomy, all 16 sections, complete service template) before writing code.

## Core philosophy

1. **Comments are visual structure.** Short `// Title.` comments above blocks act as section headers — they mark where one thing ends and another begins. **Every section comment ends with a period.** Comments are labels, not narration: "Validate Parameters." not "Now we check the inputs".
2. **Group related items; separate groups with whitespace and a label.** A Variables region holds `// Values.`, `// Mapper.`, `// Services.` groups with blank lines between.
3. **Idempotent by default.** DI registration uses `.AsImplementedInterfaces().PreserveExistingDefaults()`. Code never breaks on re-execution.
4. **Section banners over inline narration.** `#region Title` / `#endregion` organize every class.
5. **Find a sibling and mimic it.** The codebase is highly self-similar. When in doubt, find an existing file solving a similar shape and follow its layout exactly. In greenfield repos with no sibling, use the exemplar below and the full template in the reference.

## Exemplar (the shape of every method)

```csharp
public async Task<Widget?> ProcessWidgetAsync(
    WidgetRequest request,
    CancellationToken cancellationToken
)
{
    // Validate Parameters.
    if (request is null) return default;

    // Return Value.
    Widget? widget = default;

    try
    {
        // Get Widget from API.
        widget = await _eleosService.GetWidgetAsync(request.Id, cancellationToken);

        // Apply Defaults.
        widget ??= new();
        widget.ProcessedAt = DateTimeOffset.UtcNow;
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Failure Processing Widget.");
    }

    // Return the Processed Widget.
    return widget;
}
```

The comments alone tell the story of the method. That is the goal.

## Antipatterns (common AI habits that violate the style)

- ❌ XML doc comments (`/// <summary>`) — inline `// Comment.` instead
- ❌ Block-scoped namespaces in *new* files — file-scoped (`namespace X;`) for new code; leave existing block-scoped files alone
- ❌ `ILogger<T>` injection — static `Log` from Serilog
- ❌ Apologetic/explanatory comments ("This handles the case where...") — comments are imperative section labels
- ❌ Section comments without a terminating period — `// Save Services` is wrong; `// Save Services.` is correct
- ❌ `Task<T>` methods without the `Async` suffix
- ❌ `CancellationToken` anywhere but last in the parameter list
- ❌ Removing `#region` blocks because "modern style" dislikes them — they are core to this organization
- ❌ `ArgumentNullException` guards on injected dependencies — the DI container is trusted
- ❌ The null-forgiving operator `!` — use null-conditional and null-coalescing instead
- ❌ Inline SQL text in application code — data access goes through stored procedures (`CommandType.StoredProcedure`); the connection's principal is EXECUTE-only by design, so inline SQL is an architecture violation, not a shortcut

## Checklist before declaring C# work complete

- [ ] Each major section wrapped in `#region` / `#endregion`; canonical order: Constants → Variables → Constructor → public method-group regions → Private Methods
- [ ] Private fields `_camelCase`, `readonly` for injected dependencies, grouped with `// Group.` labels
- [ ] Constructor parameters one per line (8-space indent) when 2+, closing `)` on its own line, body starts `// Save Services.`
- [ ] Section comments inside methods use `// Title.` with terminating period; blank line before each
- [ ] Early returns with `default` (not `null`); `is null` / `is not null`; `??=` for late-init
- [ ] Async suffix on all `Task` methods; `CancellationToken` last and passed down the chain
- [ ] `using` lines: System.* first, then project namespaces, then third-party — no blank lines between groups; no file-header comments
- [ ] Logging via static `Log.Error(ex, "Message.")`; log messages end with a period
- [ ] DI registration in `Assembly/RegisterServices.cs`: `.AsImplementedInterfaces().PreserveExistingDefaults()`, grouped by domain label
- [ ] Class declares its interface inline: `public class FooService : IFooService`; interface in `Interfaces/IFooService.cs` with no XML docs
