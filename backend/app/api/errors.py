"""Make errors match the contract: ``{"detail": "<readable message>"}`` (plus ``errors`` for validation)."""

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _readable(error: dict) -> str:
    msg = str(error.get("msg", "Invalid value")).removeprefix("Value error, ")
    loc = [str(p) for p in error.get("loc", ()) if p not in ("body", "query", "path")]
    return f"{'.'.join(loc)}: {msg}" if loc else msg


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    detail = "; ".join(_readable(e) for e in errors[:3]) or "Invalid request."
    return JSONResponse(status_code=422, content={"detail": detail, "errors": jsonable_encoder(errors)})


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Unexpected failures answer with the ApiError shape (the server still logs the traceback)."""
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server. Please try again."})
