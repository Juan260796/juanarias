package co.edu.uniquindio.Repaso.Calculadora;

import java.util.Scanner;

public class Calculadora {
    public static void main(String[] args) {
        Scanner sc= new Scanner(System.in);
        float num1;
        float num2;
        System.out.println("Ingrese el primer numero");
        num1= sc.nextFloat();
        System.out.println("Ingrese elsegundo numero ");
        num2= sc.nextFloat();
        System.out.println("Selecciones la operacion");
        System.out.println("1) Suma");
        System.out.println("2) Resta");
        System.out.println("3) Multiplicacion");
        System.out.println("4) Division");
        int opcion=sc.nextInt();
        System.out.println(opcion);

        switch (opcion){
            case 1:
                float suma= num1+num2;
                System.out.println("El resultado de la suma es: "+suma);
                break;
            case 2:
                float resta=num1-num2;
                System.out.println("El resultado de la resta es: "+resta);
                break;
            case 3:
                float multiplicacion= num1*num2;
                System.out.println("El resultado de la multiplicacion es: "+ multiplicacion);
                break;
            case 4:
                if(num2==0){
                    System.out.println("No se puede dividir en 0");
                }else{
                    float division= num1/num2;
                    System.out.println("El resultado de la division es: "+ division);
                }
                break;
            default:
                System.out.println("La opcion ingresada no es valida");
                break;
        }
    }
}
