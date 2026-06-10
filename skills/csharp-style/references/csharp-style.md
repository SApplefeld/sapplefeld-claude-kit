# C# Style — ASR.Eleos.Documents

This is the detailed pattern reference for writing C# in Scott's style. The canonical examples come from `D:\source\repos\EleosCore\ASR.Eleos\ASR.Eleos.Documents`. When in doubt, open a sibling file in that library and follow its layout exactly.

## Table of contents

1. [File structure](#1-file-structure)
2. [Class anatomy and #region order](#2-class-anatomy-and-region-order)
3. [Field naming and grouping](#3-field-naming-and-grouping)
4. [Constructor pattern](#4-constructor-pattern)
5. [Method declarations](#5-method-declarations)
6. [Method body style and section comments](#6-method-body-style-and-section-comments)
7. [Async patterns](#7-async-patterns)
8. [Logging](#8-logging)
9. [Exception handling](#9-exception-handling)
10. [Null handling](#10-null-handling)
11. [DI / RegisterServices](#11-di--registerservices)
12. [Naming conventions](#12-naming-conventions)
13. [MediatR notifications](#13-mediatr-notifications)
14. [Models, DTOs, settings](#14-models-dtos-settings)
15. [Whitespace and indentation](#15-whitespace-and-indentation)
16. [Full service template](#16-full-service-template)

---

## 1. File structure

Every C# file in this library follows the same shape:

1. **Using statements**, ordered:
   - `System.*` namespaces first (alphabetical-ish, not strictly enforced)
   - Third-party where convenient (Serilog often appears mid-list)
   - `ASR.Eleos.*` namespaces
   - Other third-party (`AutoMapper`, `MediatR`, etc.)
   - **No blank lines between groups.**

2. **Single blank line.**

3. **Namespace declaration** — file-scoped with semicolon for new files:
   ```csharp
   namespace ASR.Eleos.Documents;
   ```
   Older files (e.g. `Assembly/RegisterServices.cs`) use block-scoped — **leave existing block-scoped files alone**, but write *new* files with file-scoped.

4. **No file-level header comments.** No copyright, no author block, no license. Files begin with `using`.

**Example** — `Services/Build/FormService.cs:1-13`:
```csharp
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;
using Serilog;
using ASR.Eleos.Domain;
using ASR.Eleos.Common.Platform;
using AutoMapper;
using System.Threading;

namespace ASR.Eleos.Documents;

public class FormService : IFormService
```

## 2. Class anatomy and #region order

Classes are organized into `#region` blocks in this canonical order:

1. `#region Constants` — `private const string` declarations (omit if none)
2. `#region Variables` — private fields, grouped by purpose with `// Group.` labels
3. `#region Constructor` — single constructor, parameters one-per-line
4. **One or more public method-group regions** — named for what they do (e.g. `#region Form Processing`, `#region Document Processing`)
5. `#region Private Methods` — at the bottom, may contain nested regions for sub-themes (`#region Form Handling`, `#region Field Handling`)

Each `#region` is closed with a matching `#endregion`. **Never leave a region open.**

**Indentation:** the `#region` and `#endregion` lines align with the *contents* (4 spaces inside a class), not the class brace.

**Example skeleton:**
```csharp
public class FormService : IFormService
{
    #region Constants
    private const string downloadUrlSuffix = ".download_url";
    private const string signatureUrlSuffix = ".signature_url";
    #endregion

    #region Variables
    // Values.
    private static StringComparison IgnoreCase => StringComparison.InvariantCultureIgnoreCase;

    // Mapper.
    private readonly Mapper _mapperService;

    // Services.
    private readonly IEleosApiService _eleosService;
    private readonly IHtmlService _htmlService;
    #endregion

    #region Constructor
    public FormService(
            IEleosApiService eleosService,
            IHtmlService htmlService
    )
    {
        // Save Services.
        _eleosService = eleosService;
        _htmlService = htmlService;
    }
    #endregion

    #region Form Processing
    public async Task<FilledForm?> ProcessFormAsync(
        FilledDocument document,
        CancellationToken cancellationToken
    )
    {
        // ...
    }
    #endregion

    #region Private Methods

        #region Form Handling
        private async Task<FilledForm?> CreateFilledFormAsync(...) { ... }
        #endregion

        #region Field Handling
        private Task<Dictionary<string, string>> ExtractFieldsAsync(...) { ... }
        #endregion

    #endregion
}
```

## 3. Field naming and grouping

- Private fields use `_camelCase` with a leading underscore: `_formService`, `_mapperService`, `_documentSettings`.
- `readonly` for all injected dependencies.
- `private const` for compile-time constants — name in `camelCase` for local scoped strings (e.g. `downloadUrlSuffix`) or `SCREAMING_SNAKE_CASE` for cross-cutting markers (e.g. `EMAIL_SENT`).
- Static computed comparison properties use **PascalCase**: `IgnoreCase`, `IgnoreCaseComparer`.

Inside `#region Variables`, fields are grouped with single-line `// Group.` label comments and a blank line between groups. Common groups:

- `// Values.` — static comparers, computed defaults
- `// Mapper.` — AutoMapper instance
- `// Services.` — injected service dependencies
- `// Settings.` — `IOptionsMonitor<T>` for configuration
- `// State.` — mutable state if any (rare)

**Example** — `Services/Build/FormService.cs:20-31`:
```csharp
#region Variables
// Values.
private static StringComparison IgnoreCase => StringComparison.InvariantCultureIgnoreCase;
private static StringComparer IgnoreCaseComparer => StringComparer.InvariantCultureIgnoreCase;

// Mapper.
private readonly Mapper _mapperService;

// Services.
private readonly IEleosApiService _eleosService;
private readonly IHtmlService _htmlService;
#endregion
```

## 4. Constructor pattern

- Single primary constructor only (no overloads, no static factories).
- Parameters on their own lines when there are 2+ — indented 8 spaces from the class brace.
- Closing `)` on its own line, indented 4 spaces (level of the constructor signature).
- Body opens with a section-comment block describing what gets assigned, then assigns directly.
- **No `ArgumentNullException` checks** — the DI container is trusted to provide non-null dependencies.
- AutoMapper instances are constructed inline in the constructor under a `// Save Mapper.` comment.

**Example** — `Services/Build/FormService.cs:33-50`:
```csharp
public FormService(
        IEleosApiService eleosService,
        IHtmlService htmlService
)
{
    // Save Services.
    _eleosService = eleosService;
    _htmlService = htmlService;

    // Save Mapper.
    var mapConfig = new MapperConfiguration(c =>
    {
        c.CreateMap<Form, FilledForm>();
        c.CreateMap<FormField, FilledFormField>();
    });
    _mapperService = new Mapper(mapConfig);
}
```

## 5. Method declarations

- **No XML doc comments** (`/// <summary>`). Public methods are self-documenting via name plus a section comment block inside the body.
- Async methods always end in `Async`.
- `CancellationToken` is always the **last** parameter.
- Multi-parameter methods break each parameter onto its own line (4-space indent), closing `)` on its own line at the method-signature indent.
- Return types use nullable annotations (`Task<FilledForm?>`) when nulls are valid.
- No method-level attributes except where required (e.g. MediatR handler signature).

**Example** — `Services/Build/FormService.cs:54-57`:
```csharp
public async Task<FilledForm?> ProcessFormAsync(
    FilledDocument document,
    CancellationToken cancellationToken
)
```

## 6. Method body style and section comments

This is the heart of the style. **Method bodies are organized as a sequence of named sections**, each preceded by a `// Title.` comment. The comment names *what the next block does*, not what the block did or why.

Conventions:
- Comment text uses Title Case ("Validate Parameters." not "validate parameters.")
- **Always end with a period.**
- One blank line *before* the comment is preferred between sections.
- Comments are not narrative — they're labels. Avoid "Now we...", "Here we...", "This will..."

Common section comments:
- `// Validate Parameters.` — guard clauses at the top
- `// Return Value.` — declaring the return-value variable
- `// Declare Variables.` — pre-declaring locals used across try blocks
- `// Get X.` / `// Extract X.` / `// Build X.` / `// Apply X.` — major operations
- `// Return the Processed Result.` — at the bottom

**Other body conventions:**
- **Early returns** for null/invalid input: `if (document == null) return default;`
- `default` keyword for null returns on nullable types, not `null`
- `is null` / `is not null` over `== null` / `!= null` for clarity
- `??=` for default assignment: `filledDocument ??= new();`
- `var` when the type is obvious from the right-hand side
- LINQ method chains, not query syntax
- String interpolation `$"..."` over `string.Format` or concatenation

**Example** — `Services/Build/FormService.cs:54-118`:
```csharp
public async Task<FilledForm?> ProcessFormAsync(
    FilledDocument document,
    CancellationToken cancellationToken
)
{
    // Validate Parameters.
    if (document == null) return default;

    // Return Value.
    FilledForm? form = default;

    try
    {
        // Extract Document Fields from Document.
        var values = await ExtractFieldsAsync(document, cancellationToken);

        // Document Form is only known by "FormCode", Validate.
        _ = values.TryGetValue("FormCode", out var formCode);
        if (formCode.IsNullOrWhiteSpace()) return default;

        // Get Processed Form with Fields.
        form = await CreateFilledFormAsync(formCode, values, cancellationToken);
        form ??= new();

        // Get Document Type.
        var docType = document.DocumentTypes?.FirstOrDefault() ?? "Document";

        // Set Form Properties.
        form.Submitted = document.UploadFinishedAt;
        form.UserId = document.ScannedByUsername;
        form.Title = header.IsNotNullOrWhiteSpace() ? header : docType;

        // Update HTML with Changes.
        await UpdateFormHtmlAsync(form, cancellationToken);

        // Apply the Form to the Document.
        document.FilledForm = form;
    }
    catch (Exception ex)
    {
        Log.Error(ex, "Failure Processing Document.");
    }

    // Return the Processed Form.
    return form;
}
```

Notice how the comments alone tell the story of the method. That's the goal.

## 7. Async patterns

- All async methods suffix with `Async`.
- Cancellation tokens always last; pass them down the call chain.
- Synchronous helpers that return `Task<T>` for interface uniformity use `Task.FromResult(...)` rather than converting to a sync signature.
- Synchronous helpers returning `Task` use `Task.CompletedTask`.
- `ConfigureAwait(false)` appears in **background services** (`Services/Background/*`) but not in regular services. Match the surrounding file.
- All `Task` / `Task<T>` returns — **no `ValueTask`** in this codebase.

## 8. Logging

- Logger is the **static `Log` from Serilog**, used directly. No `ILogger<T>` is injected.
- `using Serilog;` appears in the using list.
- Standard pattern in catch blocks:
  ```csharp
  catch (Exception ex)
  {
      Log.Error(ex, "Failure Processing Document.");
  }
  ```
- `Log.Debug($"...")` is used in output/EBE services for trace-level diagnostics with method-name prefixed messages: `Log.Debug($"ASR.Eleos.Documents.PdfService.CreateFromHtmlAsync called with Html: {html}");`
- Log messages always end in a period.

## 9. Exception handling

- `try { ... } catch (Exception ex) { Log.Error(...); }` is the dominant shape. The catch logs and the method returns `default`.
- Background services add a `finally` for delay/sleep loops: see `Services/Background/DocumentProcessingService.cs:51-70`.
- `throw;` (re-throw) is used sparingly when the exception must propagate; `throw ex;` is never used.
- Custom exception types are not used in this library — only generic `Exception`.

## 10. Null handling

- Nullable reference types are enabled (`<Nullable>enable</Nullable>` in csproj).
- Nullable annotations on returns and params: `Task<FilledForm?>`, `Stream?`.
- `_ = values.TryGetValue("Key", out var value);` to suppress unused return.
- `??=` for late-init defaults.
- `??` chains for fallback values.
- The null-forgiving operator `!` is **not used** — code relies on null-conditional and null-coalescing instead.

## 11. DI / RegisterServices

`Assembly/RegisterServices.cs` is the Autofac module that registers everything in the library. Every type registers the same way:

```csharp
builder.RegisterType<DocumentService>()
       .AsImplementedInterfaces()
       .PreserveExistingDefaults();
```

- `.AsImplementedInterfaces()` — interfaces are inferred from the implementation
- `.PreserveExistingDefaults()` — respects any prior registration

Registrations are grouped by domain with **uppercase** label comments:

```csharp
// HANDLERS
builder.RegisterType<AzureFileSaveHandler>()
       .AsImplementedInterfaces()
       .PreserveExistingDefaults();

// BACKGROUND.
builder.RegisterType<DocumentProcessingService>()
       .AsImplementedInterfaces()
       .PreserveExistingDefaults();

// SERVICES.
builder.RegisterType<DocumentOutputService>()
       .AsImplementedInterfaces()
       .PreserveExistingDefaults();
```

(The `.` after some labels is inconsistent in existing code; both `// HANDLERS` and `// BACKGROUND.` appear. Match the surrounding file.)

`RegisterServices.cs` is a **block-scoped namespace** file — leave it that way when editing.

For settings, services inject `IOptionsMonitor<TSettings>` (not `IOptions<T>`) and read `.CurrentValue` at use time.

## 12. Naming conventions

| Suffix | Used for | Example |
| --- | --- | --- |
| `Service` | Core operations and orchestration | `DocumentService`, `FormService`, `PdfService` |
| `Handler` | MediatR notification handlers | `AzureFileSaveHandler`, `NetworkFileSaveHandler` |
| `Helper` | Static utility methods | `DocumentHelper`, `FieldHelper`, `FormHelper` |
| `Notification` | MediatR notifications | `DocumentProcessedNotification`, `FileSaveNotification` |
| `Repository` (Legacy only) | Older data-access objects | `DocumentBatchRepository` |

**Method verb prefixes:**
- `Get*` — read or fetch (`GetFilledDocumentAsync`, `GetVisibleFields`)
- `Process*` — orchestrate a pipeline (`ProcessDocumentAsync`, `ProcessFormAsync`)
- `Create*` — build a new value (`CreateFilledFormAsync`, `CreateArchiveForDocumentAsync`)
- `Extract*` — pull data from a structure (`ExtractFieldsAsync`)
- `Build*` — construct a complex output
- `Save*` / `Set*` — write or assign

**Interfaces:** `I` prefix matching the implementation: `IDocumentService` ↔ `DocumentService`.

## 13. MediatR notifications

Notifications are simple data holders:

```csharp
public class FileSaveNotification : INotification
{
    public string Caller { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public CancellationToken CancellationToken { get; set; }
}
```

Handlers implement `INotificationHandler<T>` and live in the `Handlers/` folder.

Publishing pattern:
```csharp
await _mediator.Publish(
    new MessageProcessedNotification
    {
        Caller = nameof(EbeOutputService),
        Message = message,
        FilledForm = filledForm,
        CancellationToken = cancellationToken
    }
);
```

`Caller = nameof(...)` is a consistent convention so handlers know who fired the notification.

## 14. Models, DTOs, settings

Models live under `Models/` and are organized by purpose:
- `Models/Database/` — DB-shaped data
- `Models/Documents/` — domain documents and forms
- `Models/Email/` — email shapes
- `Models/Settings/` — settings classes for `IOptionsMonitor<T>`

Settings classes are plain DTOs with `{ get; set; }` auto-properties. They do **not** use records.

Init values use collection expressions where natural:
```csharp
public List<byte[]> Images { get; set; } = [];
public List<Tuple<string, string>> Tokens { get; set; } = [];
public string FormCode { get; set; } = string.Empty;
public FilledForm FilledForm { get; set; } = new();
```

## 15. Whitespace and indentation

- **4 spaces** for indentation, never tabs.
- **One blank line** between methods within a region.
- **One blank line** between regions (after `#endregion`, before next `#region`).
- **One blank line** between field groups (after the labeled comment finishes a group).
- **One blank line** between *logical phases* inside a method (right before each `// Section.` comment is preferred).
- **No blank line** between using statements.
- **Long parameter lists** indent each parameter 8 spaces; closing `)` indents to the method signature column.

## 16. Full service template

When creating a brand-new service in `Services/Build/` or `Services/Process/`, use this skeleton:

```csharp
using System;
using System.Threading;
using System.Threading.Tasks;
using Serilog;
using ASR.Eleos.Domain;

namespace ASR.Eleos.Documents;

public class WidgetService : IWidgetService
{
    #region Variables
    // Services.
    private readonly IEleosApiService _eleosService;
    #endregion

    #region Constructor
    public WidgetService(
            IEleosApiService eleosService
    )
    {
        // Save Services.
        _eleosService = eleosService;
    }
    #endregion

    #region Widget Processing
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
    #endregion

    #region Private Methods
    // (private helpers here, in nested regions if multiple themes)
    #endregion
}
```

Then register it in `Assembly/RegisterServices.cs` under the appropriate label, e.g. under `// SERVICES.`:

```csharp
builder.RegisterType<WidgetService>()
       .AsImplementedInterfaces()
       .PreserveExistingDefaults();
```

And declare its interface in `Interfaces/IWidgetService.cs` — with no XML doc comments, just the interface body.
