from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import Services, get_services
from app.schemas import ExampleCase, Variable

router = APIRouter(tags=["catalog"])


@router.get("/variables", response_model=list[Variable])
def list_variables(services: Services = Depends(get_services)) -> list[Variable]:
    return [v.public() for v in services.catalog.variables()]


@router.get("/variables/{variable_id}", response_model=Variable)
def get_variable(variable_id: str, services: Services = Depends(get_services)) -> Variable:
    variable = services.catalog.get(variable_id)
    if variable is None:
        raise HTTPException(404, f"Unknown variable '{variable_id}'.")
    return variable.public()


@router.get("/examples", response_model=list[ExampleCase])
def list_examples(services: Services = Depends(get_services)) -> list[ExampleCase]:
    return services.catalog.examples()
