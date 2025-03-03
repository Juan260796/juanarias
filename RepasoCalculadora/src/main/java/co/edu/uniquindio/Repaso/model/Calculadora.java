package co.edu.uniquindio.Repaso.model;
import java.util.Scanner;

public class Calculadora {
    Scanner sc= new Scanner(System.in);
    public float operacionSuma(float num1, float num2){
        return num1+num2;
    }
    public float operacionResta(float num1, float num2){
        return num1-num2;
    }
    public float operacionMultiplicacion(float num1, float num2){
        return num1*num2;
    }
    public float operacionDivision(float num1, float num2){
        return num1/num2;
    }

    public void menu(){
        System.out.println("Seleccione la operacion");
        System.out.println("1) Para sumar");
        System.out.println("2) Para restar");
        System.out.println("3) para multiplicar");
        System.out.println("4) Para dividir");
    }

    public float[] pedirDatos(){
        System.out.println("ingrese el primer numero");
        float num1=sc.nextFloat();
        System.out.println("Ingrese el segundo numero");
        float num2=sc.nextFloat();

        return new float []{num1,num2};

    }
}

